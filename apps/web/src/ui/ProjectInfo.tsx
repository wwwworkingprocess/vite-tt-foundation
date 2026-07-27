import { protocolContractVersion } from '@torrevieja-tycoon/protocol';
import { simulationFoundationLabel } from '@torrevieja-tycoon/simulation';

export default function ProjectInfo() {
  return (
    <section aria-labelledby="foundation-title">
      <p className="eyebrow">Project foundation</p>
      <h1 id="foundation-title">Torrevieja Tycoon</h1>
      <p>
        A strict workspace for a standalone simulation and its browser client.
      </p>
      <dl aria-label="Workspace package status">
        <div>
          <dt>Simulation</dt>
          <dd>{simulationFoundationLabel}</dd>
        </div>
        <div>
          <dt>Protocol contract</dt>
          <dd>version {protocolContractVersion}</dd>
        </div>
      </dl>
    </section>
  );
}
