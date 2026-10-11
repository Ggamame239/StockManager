import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let app
export let auth
export let db

function getFirebaseServices() {
    const missingConfig = Object.entries(firebaseConfig).filter(([, value]) => !value)
    if (missingConfig.length) {
        const names = missingConfig.map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)
        throw new Error(`ยังไม่ได้ตั้งค่า Firebase: ${names.join(', ')}`)
    }
    if (!app) {
        app = getApps().length ? getApp() : initializeApp(firebaseConfig)
        auth = getAuth(app)
        db = getFirestore(app)
    }
    return { auth, db }
}

let anonymousAuthPromise

export function ensureAnonymousAuth() {
    const services = getFirebaseServices()
    if (services.auth.currentUser) return Promise.resolve(services.auth.currentUser)
    if (anonymousAuthPromise) return anonymousAuthPromise

    anonymousAuthPromise = new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(services.auth, (user) => {
            unsubscribe()
            if (user) {
                resolve(user)
                return
            }
            signInAnonymously(services.auth).then(resolve, reject)
        }, (error) => {
            unsubscribe()
            reject(error)
        })
    }).catch((error) => {
        anonymousAuthPromise = null
        if (error.code === 'auth/configuration-not-found' || error.code === 'auth/operation-not-allowed') {
            throw new Error('Firebase Authentication ยังไม่พร้อม: เปิด Authentication ใน Firebase Console และเปิด Anonymous sign-in แล้วลองใหม่')
        }
        throw error
    })

    return anonymousAuthPromise
}
