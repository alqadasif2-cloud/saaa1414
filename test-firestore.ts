import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId);

async function test() {
  console.log('Testing Firestore connection to project:', firebaseConfig.projectId, 'database:', firebaseConfig.firestoreDatabaseId);
  try {
    const channelsSnap = await getDocs(collection(db, 'community_channels'));
    console.log('community_channels count:', channelsSnap.size);
    channelsSnap.forEach(d => console.log(' Channel:', d.id, d.data().name, d.data().visibility));
  } catch (err: any) {
    console.error('Error fetching community_channels:', err.message, err.code);
  }

  try {
    const usersSnap = await getDocs(collection(db, 'community_users'));
    console.log('community_users count:', usersSnap.size);
    usersSnap.forEach(d => console.log(' User:', d.id, d.data().username, d.data().displayName, d.data().role));
  } catch (err: any) {
    console.error('Error fetching community_users:', err.message, err.code);
  }

  try {
    const chatSnap = await getDocs(collection(db, 'chat_messages'));
    console.log('chat_messages count:', chatSnap.size);
  } catch (err: any) {
    console.error('Error fetching chat_messages:', err.message, err.code);
  }

  try {
    const pmSnap = await getDocs(collection(db, 'private_messages'));
    console.log('private_messages count:', pmSnap.size);
  } catch (err: any) {
    console.error('Error fetching private_messages:', err.message, err.code);
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
