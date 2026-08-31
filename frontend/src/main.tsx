import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionRenderer } from './production/ProductionRenderer';
import { PetRenderer } from './production/PetRenderer';
import { RecoveryWindow } from './recovery/RecoveryWindow';
import './styles/global.css';

const isPetWindow = new URLSearchParams(window.location.search).get('pet') === '1';
const isRecoveryWindow = new URLSearchParams(window.location.search).get('recovery') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isRecoveryWindow ? <RecoveryWindow bridge={window.recoveryBridge} /> : isPetWindow ? <PetRenderer /> : <ProductionRenderer />}
  </StrictMode>,
);
