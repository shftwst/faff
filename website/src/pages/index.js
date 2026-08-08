import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

const paths = [
  {
    title: 'Delivery',
    body: 'Move tracker work through planning, specification, implementation, review, and delivery.',
    to: '/concept/what-is-faff',
  },
  {
    title: 'Governance',
    body: 'See how Commissaire records evidence, checks boundaries, and returns uncertain work to a person.',
    to: '/concept/execution-and-governance',
  },
  {
    title: 'Get started',
    body: 'Install the faff plugin and take one piece of work through the supervised delivery path.',
    to: '/guide/intro',
  },
  {
    title: 'Evidence',
    body: 'Inspect the audits, current support boundaries, and work still needed to prove the strongest claims.',
    to: '/concept/evidence',
  },
];

export default function Home() {
  return (
    <Layout
      title="SuperDomestique"
      description="A governed delivery system for handing more software work to agents without losing authority or evidence."
    >
      <main className="home">
        <section className="homeHero">
          <p className="homeEyebrow">Governed software delivery</p>
          <h1>
            SuperDomestique (formerly known as <code>faff</code>)
          </h1>
          <p className="homeStrapline">
            Give agents more of the work. Keep hold of the decision.
          </p>
          <p className="homeLead">
            SuperDomestique moves work from intent to delivery. Its governance
            system, Commissaire, checks the evidence at each boundary and sends
            unresolved decisions back to a person.
          </p>
          <p className="homeDistribution">
            Available today as the <code>faff</code> plugin and CLI.
          </p>
          <div className="homeActions">
            <Link className="button button--primary button--lg" to="/guide/walkthroughs">
              Take the first run
            </Link>
            <Link className="button button--secondary button--lg" to="/concept/levels">
              See the trust levels
            </Link>
          </div>
        </section>

        <section className="homeStatus" aria-labelledby="current-status">
          <h2 id="current-status">What works today</h2>
          <p>
            L1 and L2 support interactive work. L3 drains eligible work
            unattended and parks ambiguity. L4 is a preview: its mechanisms
            exist, but the external evidence needed for a complete claim does not.
          </p>
        </section>

        <section className="homePaths" aria-label="Documentation paths">
          {paths.map((path) => (
            <Link className="homePath" to={path.to} key={path.title}>
              <h2>{path.title}</h2>
              <p>{path.body}</p>
              <span>Read more</span>
            </Link>
          ))}
        </section>
      </main>
    </Layout>
  );
}
