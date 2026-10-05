/*
  POST /api/statements/forget: the service deletes its read-only scan of exactly this key set
  (the viewer database that keeps the keys so the next statement is quick). An older service
  without the endpoint answers 404; that is said in plain words, since the keys are forgotten in
  the tab either way.
*/
import { ApiError, api } from "@/lib/api";

export async function forgetKeysOnService(ufvks: string[]): Promise<{ forgotten: boolean }> {
  try {
    return await api.forgetKeys(ufvks);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      throw new ApiError(err.status, {
        code: "forget_unsupported",
        message: "This Payslip service cannot forget keys yet.",
        hint: "They are forgotten in this tab. The service's copy reads payments only and cannot spend.",
      });
    }
    throw err;
  }
}
