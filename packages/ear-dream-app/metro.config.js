const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
// woff2 는 Metro 기본 assetExts 에 없다 (ttf 는 있다). 웹은 같은 서브셋의 woff2 를
// 쓰므로(src/constants/fonts.web.ts — 전송이 절반이다) 확장자를 열어 준다.
config.resolver.assetExts = [...config.resolver.assetExts, 'woff2'];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
