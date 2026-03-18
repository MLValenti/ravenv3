import { getEvidenceProvider, registerEvidenceProvider } from "../evidence-provider";
import { coverageChangeEvidenceProvider } from "./coverage-change-provider";

export const DEFAULT_EVIDENCE_PROVIDER_ID = coverageChangeEvidenceProvider.id;

export function ensureDefaultEvidenceProvidersRegistered(): void {
  if (!getEvidenceProvider(coverageChangeEvidenceProvider.id)) {
    registerEvidenceProvider(coverageChangeEvidenceProvider);
  }
}
