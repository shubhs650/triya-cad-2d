import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode: its double-run effects would transfer each canvas to the render worker twice,
// and a canvas can be transferred only once.
createRoot(document.getElementById('root')!).render(<App />);
