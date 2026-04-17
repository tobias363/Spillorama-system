export type KycDecision = "VERIFIED" | "REJECTED";

export interface VerifyKycInput {
  userId: string;
  birthDate: string;
  nationalId?: string;
}

export interface VerifyKycResult {
  decision: KycDecision;
  providerReference: string;
  checkedAt: string;
  reason?: string;
}

export interface KycAdapter {
  verify(input: VerifyKycInput): Promise<VerifyKycResult>;
}
