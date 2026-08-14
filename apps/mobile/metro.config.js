const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// packages/shared는 Node.js ESM 규칙에 맞춰 .js 확장자로 import하도록 작성되어 있음
// (실제 파일은 .ts). Metro가 .js를 요청받아도 .ts 파일을 찾도록 확장자 우선순위를 확장한다.
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js') && moduleName.startsWith('.')) {
    const tsModuleName = moduleName.replace(/\.js$/, '.ts');
    try {
      return context.resolveRequest(context, tsModuleName, platform);
    } catch {
      // .ts로 못 찾으면 원래 방식대로 시도
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;