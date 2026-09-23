import { createRoot } from 'react-dom/client';
import { BacktestPanel } from './BacktestPanel';
import './standalone.css';
createRoot(document.getElementById('root')!).render(<BacktestPanel/>);
