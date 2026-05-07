import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCYP_-jjKhrlch0For4WW31oXFzaRL5qwU",
  authDomain: "belasaas-e1757.firebaseapp.com",
  projectId: "belasaas-e1757",
  storageBucket: "belasaas-e1757.firebasestorage.app",
  messagingSenderId: "491409561043",
  appId: "1:491409561043:web:a3f001ea4cc483ddd88b26",
  measurementId: "G-NTB6D71D0S"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, db, auth, googleProvider, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged, updateProfile, Timestamp };
