import path from 'node:path';
import { defineConfig } from './references/test-reporter/config.mjs';

const rootDir = import.meta.dirname;
const webDir = path.join(rootDir, 'packages', 'web');
const agentMasterDir = path.join(rootDir, 'packages', 'agent-master');
const agentSlaveDir = path.join(rootDir, 'packages', 'agent-slave');

export default defineConfig({
  schemaVersion: '1',
  project: {
    name: 'project-commander',
    rootDir,
    outputDir: path.join(rootDir, 'artifacts', 'workspace-tests'),
    rawDir: path.join(rootDir, 'artifacts', 'workspace-tests', 'raw'),
  },
  workspaceDiscovery: {
    provider: 'explicit',
    packages: ['web', 'server', 'agent-master', 'agent-slave', 'agent-shared'],
  },
  execution: {
    dryRun: false,
    continueOnError: true,
    defaultCoverage: false,
  },
  render: {
    html: true,
    console: true,
    defaultView: 'package',
  },
  enrichers: {
    sourceAnalysis: {
      enabled: true,
    },
  },
  suites: [
    {
      id: 'web-unit',
      label: 'Web Unit',
      adapter: 'node-test',
      package: 'web',
      cwd: webDir,
      command: [
        'node',
        '--test',
        'src/components/infinite-log/windowing.test.js',
        'src/lib/logQueryProtocol.test.js',
        'src/features/home/lib/logViewer.test.js',
        'src/features/home/hooks/hostActionUtils.test.js',
        'src/features/home/hooks/terminalActionUtils.test.js',
      ],
      env: {
        NODE_ENV: 'test',
      },
      coverage: {
        enabled: true,
        mode: 'same-run',
      },
    },
    {
      id: 'web-ui',
      label: 'Web UI',
      adapter: 'playwright',
      package: 'web',
      cwd: webDir,
      command: ['yarn', 'run', 'test:ui:report'],
      coverage: {
        enabled: false,
      },
    },
    {
      id: 'agent-master-go',
      label: 'Agent Master Go',
      adapter: 'go-test',
      handler: './scripts/test-reporter/go-test-adapter.mjs',
      package: 'agent-master',
      cwd: agentMasterDir,
      command: ['go', 'test', '-json', './...'],
      coverage: {
        enabled: false,
      },
    },
    {
      id: 'agent-slave-go',
      label: 'Agent Slave Go',
      adapter: 'go-test',
      handler: './scripts/test-reporter/go-test-adapter.mjs',
      package: 'agent-slave',
      cwd: agentSlaveDir,
      command: ['go', 'test', '-json', './...'],
      coverage: {
        enabled: false,
      },
    },
  ],
  adapters: [],
});
