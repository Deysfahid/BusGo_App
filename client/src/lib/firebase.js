// Firebase is used ONLY as the Google identity provider. The Firebase ID token is
// sent to the BusGo backend, which verifies it and issues the existing BusGo JWT.
// The Firebase token is never used as the app session.
//
// Web config values are public by design and come from VITE_* env vars.
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Google Sign-In is optional: with no config the rest of the app (including
// email/password login) works unchanged and the Google button reports it's off.
export const firebaseEnabled = Boolean(config.apiKey && config.authDomain && config.projectId)

let auth = null
if (firebaseEnabled) {
  auth = getAuth(initializeApp(config))
}

/** Opens the Google popup and returns the Firebase ID token for the backend. */
export const signInWithGoogle = async () => {
  if (!firebaseEnabled) {
    throw new Error('Google Sign-In is not configured')
  }
  const provider = new GoogleAuthProvider()
  const result = await signInWithPopup(auth, provider)
  return result.user.getIdToken()
}
