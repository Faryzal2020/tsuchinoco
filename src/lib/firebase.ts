import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// When the env file is missing (or at static build time) the SDK must still load without
// throwing; the AppShell gate shows a "not configured" screen and nothing talks to Firebase.
const placeholder = { apiKey: 'not-configured', authDomain: 'not-configured', projectId: 'not-configured', appId: 'not-configured' };
const app = getApps().length ? getApp() : initializeApp(isFirebaseConfigured ? firebaseConfig : placeholder);

function makeDb(): Firestore {
  if (typeof window === 'undefined') return getFirestore(app);
  try {
    // Offline persistence so the pickup list and wrap-up keep working on venue wifi.
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = makeDb();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const functions = getFunctions(app, process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'asia-southeast1');

// Local emulators (firebase emulators:start). Ports match firebase.json.
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
  const w = window as unknown as { __emulatorsConnected?: boolean };
  if (!w.__emulatorsConnected) {
    w.__emulatorsConnected = true;
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, 'localhost', 5001);
  }
}
