import { ethers, type UnsignedTransaction } from "ethers";
import { PublicApiService } from "@turnkey/http";

type TActivity = PublicApiService.TPostGetActivityResponse["activity"];
type TActivityId = TActivity["id"];
type TActivityStatus = TActivity["status"];
type TActivityType = TActivity["type"];

type TConfig = {
  organizationId: string;
  keyId: string;
};

export class TurnkeyActivityError extends Error {
  activityId: TActivityId | null;
  activityStatus: TActivityStatus | null;
  activityType: TActivityType | null;
  cause: Error | null;

  constructor(input: {
    message: string;
    cause?: Error | null;
    activityId?: TActivityId | null;
    activityStatus?: TActivityStatus | null;
    activityType?: TActivityType | null;
  }) {
    const { message, cause, activityId, activityStatus, activityType } = input;
    super(message);

    this.name = "TurnkeyActivityError";
    this.activityId = activityId ?? null;
    this.activityStatus = activityStatus ?? null;
    this.activityType = activityType ?? null;
    this.cause = cause ?? null;
  }
}

export class TurnkeySigner extends ethers.Signer {
  private readonly config: TConfig;

  constructor(config: TConfig, provider?: ethers.providers.Provider) {
    super();

    ethers.utils.defineReadOnly(this, "provider", provider);
    this.config = config;
  }

  connect(provider: ethers.providers.Provider): TurnkeySigner {
    return new TurnkeySigner(this.config, provider);
  }

  async getAddress(): Promise<string> {
    const data = await PublicApiService.postGetKey({
      body: {
        keyId: this.config.keyId,
        organizationId: this.config.organizationId,
      },
    });

    const maybeAddress = data.key.addresses.find(
      (item) => item.format === "ADDRESS_FORMAT_ETHEREUM"
    )?.address;

    if (typeof maybeAddress !== "string" || !maybeAddress) {
      throw new TurnkeyActivityError({
        message: `Unable to find Ethereum address for key ${this.config.keyId} under organization ${this.config.organizationId}`,
      });
    }

    return maybeAddress;
  }

  private async _signTransactionImpl(message: string): Promise<string> {
    const { activity } = await PublicApiService.postSignTransaction({
      body: {
        request: {
          requestId: process.hrtime().join(""), // nanosecond timestamp
          organizationId: this.config.organizationId,
          type: "ACTIVITY_TYPE_SIGN_TRANSACTION",
          intent: {
            keyId: this.config.keyId,
            organizationId: this.config.organizationId,
            type: "TRANSACTION_TYPE_ETHEREUM",
            unsignedTransaction: message,
          },
        },
      },
    });

    const { id, status, type } = activity;

    if (activity.status === "ACTIVITY_STATUS_COMPLETED") {
      return assertNonNull(
        activity?.result?.signTransactionResult?.signedTransaction
      );
    }

    throw new TurnkeyActivityError({
      message: `Invalid activity status: ${activity.status}`,
      activityId: id,
      activityStatus: status,
      activityType: type,
    });
  }

  private async _signTransactionWithErrorWrapping(
    message: string
  ): Promise<string> {
    let signedTx: string;
    try {
      signedTx = await this._signTransactionImpl(message);
    } catch (error) {
      if (error instanceof TurnkeyActivityError) {
        throw error;
      }

      throw new TurnkeyActivityError({
        message: `Failed to sign`,
        cause: error as Error,
      });
    }

    return signedTx;
  }

  async signMessage(_message: string | ethers.utils.Bytes): Promise<string> {
    throw new Error("Not implemented yet");
  }

  async signTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<string> {
    const unsignedTx = await ethers.utils.resolveProperties(transaction);
    const serializedTx = ethers.utils.serializeTransaction(
      unsignedTx as UnsignedTransaction
    );
    const nonHexPrefixedSerializedTx = serializedTx.replace(/^0x/, "");
    const signedTx = await this._signTransactionWithErrorWrapping(
      nonHexPrefixedSerializedTx
    );
    return `0x${signedTx}`;
  }
}

export function assertNonNull<T>(input: T | null | undefined): T {
  if (input == null) {
    throw new Error(`Got unexpected ${JSON.stringify(input)}`);
  }

  return input;
}

export function assertNever(input: never, message?: string): never {
  throw new Error(
    message != null ? message : `Unexpected case: ${JSON.stringify(input)}`
  );
}