// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Start here',
      items: [
        'walkthroughs',
        'adopting-by-change-class',
        'configuration',
        'harness-support',
      ],
    },
    {
      type: 'category',
      label: 'Run unattended',
      items: ['unattended', 'run-outcomes', 'self-hosted-rig'],
    },
    {
      type: 'category',
      label: 'Govern delivery',
      items: ['governance-check'],
    },
    {
      type: 'category',
      label: 'Extend and reference',
      items: ['skills', 'architecture', 'cli'],
    },
  ],
};

module.exports = sidebars;
