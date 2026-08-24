import { mustWrite } from "@/lib/app-errors";

/** Link first: a review item must not be finalized when its household write failed. */
export async function linkHouseholdBeforeFinalize<T>(
  write: PromiseLike<{ error: { message?: string } | null }>,
  finalize: () => Promise<T>,
): Promise<T> {
  await mustWrite(write, "The contact couldn't be linked to the household.");
  return finalize();
}
