/**
 * Form state for the sign-in action.
 *
 * Separate from actions.ts because a "use server" module may only export async
 * functions — exporting a plain object from one fails the build with
 * "A 'use server' file can only export async functions, found object."
 */

export interface SignInState {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
}

export const SIGN_IN_INITIAL_STATE: SignInState = { status: "idle" };
