import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFirebaseApp } from './app';

export { getFirebaseApp };

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

let storageEmulatorConnected = false;

export function getBucket(): FirebaseStorage {
  const storage = getStorage(getFirebaseApp());
  // Local testing only: `host:port` of the Storage emulator.
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST;
  if (emulator && !storageEmulatorConnected) {
    const [host = '127.0.0.1', port = '9199'] = emulator.split(':');
    connectStorageEmulator(storage, host, Number(port));
    storageEmulatorConnected = true;
  }
  return storage;
}
