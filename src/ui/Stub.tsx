import styles from './Stub.module.css';

/** Marcador de los stubs de T0: cada carril lo borra al implementar su pieza. */
export function Stub({ name, lane }: { name: string; lane: string }) {
  return (
    <div className={styles.stub} data-stub={name} role="note">
      <strong>{name}</strong>
      <span>Pendiente del carril {lane}.</span>
    </div>
  );
}
