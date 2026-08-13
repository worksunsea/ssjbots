// Server-side Firebase ID token verification for the ssj.in client login
// (Google + phone via Firebase, added alongside the existing WA-OTP flow —
// see clientAuth.js). verifyIdToken() only needs the project ID, not a full
// service-account key: it validates the JWT signature against Google's
// public certs and checks aud/iss/exp itself.

import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT_ID = "ssj-in";

function getFirebaseAdminApp() {
  return getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
}

// Returns { uid, email, phoneNumber, name } or null if invalid/expired.
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken) return null;
  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      phoneNumber: decoded.phone_number || null,
      name: decoded.name || null,
    };
  } catch {
    return null;
  }
}
