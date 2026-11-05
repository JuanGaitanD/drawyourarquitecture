import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ height: 300 }}><Excalidraw /></div>
    <div style={{ height: 300 }}><ReactFlow nodes={[]} edges={[]} /></div>
  </StrictMode>,
);
