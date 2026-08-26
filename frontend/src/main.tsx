import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionRenderer } from './production/ProductionRenderer';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProductionRenderer />
  </StrictMode>,
);
