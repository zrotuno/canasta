// Firebase web config. These values are public identifiers, not secrets — the
// database is protected by Firestore security rules, not by hiding this file.
//
// TODO before 8/28: the project is still in Firestore "test mode", which lets
// anyone read and write, and which expires 30 days after creation. Replace it
// with rules that only allow writes to the moves list of an active game.
export const firebaseConfig = {
  apiKey: 'AIzaSyD-V3wYa9XYyzyUATB1CnQRgixVIQaYTSg',
  authDomain: 'canasta-2d40e.firebaseapp.com',
  projectId: 'canasta-2d40e',
  storageBucket: 'canasta-2d40e.firebasestorage.app',
  messagingSenderId: '470376735914',
  appId: '1:470376735914:web:506d4cf0ba53c0f521dcd3',
};
