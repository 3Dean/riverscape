import { signIn, confirmSignIn, getCurrentUser, signOut } from "aws-amplify/auth";

export async function currentUserSub(): Promise<string | null> {
  try {
    const u = await getCurrentUser();
    return u.userId; // Cognito "sub"
  } catch {
    return null;
  }
}

export async function startEmailOtp(email: string) {
  // With otpLogin enabled, signIn triggers the OTP challenge flow
  return await signIn({ username: email });
}

export async function confirmEmailOtp(code: string) {
  return await confirmSignIn({ challengeResponse: code });
}

export async function logout() {
  return await signOut();
}
