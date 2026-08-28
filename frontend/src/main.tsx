import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionRenderer } from './production/ProductionRenderer';
import { PetRenderer } from './production/PetRenderer';
import './styles/global.css';

const isPetWindow = new URLSearchParams(window.location.search).get('pet') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPetWindow ? <PetRenderer /> : <ProductionRenderer />}
  </StrictMode>,
);
