'use strict';
// Real-world values used to build believable fingerprints. [value, weight]

const GPUS = {
  windows: [
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C82) Direct3D11 vs_5_0 ps_5_0, D3D11)', 4],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)', 7],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 (0x00001F08) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 (0x00002507) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', 9],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti (0x00002489) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)', 4],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)', 7],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11)', 4],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 2],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 6],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)', 5],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 7],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)', 3],
  ],
  macos: [
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 8],
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 4],
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 6],
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)', 4],
    ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', 2],
  ],
  linux: [
    ['Google Inc. (NVIDIA Corporation)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1660/PCIe/SSE2, OpenGL 4.5.0)', 4],
    ['Google Inc. (NVIDIA Corporation)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)', 4],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', 5],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23, LLVM 17.0.6, DRM 3.54), OpenGL 4.6)', 3],
  ],
};

const SCREENS = {
  windows: [
    ['1920x1080', 40], ['1366x768', 8], ['1536x864', 9], ['2560x1440', 12], ['1440x900', 3], ['1600x900', 4],
    ['1680x1050', 2], ['1920x1200', 4], ['2560x1080', 2], ['3440x1440', 2], ['3840x2160', 3], ['1280x1024', 1],
  ],
  macos: [['1440x900', 5], ['1512x982', 6], ['1728x1117', 4], ['1470x956', 5], ['2560x1440', 3], ['1920x1080', 3]],
  linux: [['1920x1080', 10], ['2560x1440', 4], ['1366x768', 2], ['1920x1200', 2]],
};

const CPU = {
  windows: [[4, 10], [6, 12], [8, 20], [12, 18], [16, 16], [20, 6], [24, 4]],
  macos: [[8, 10], [10, 6], [12, 4]],
  linux: [[4, 6], [8, 10], [12, 6], [16, 6]],
};

const MEMORY = [[4, 2], [8, 10]]; // navigator.deviceMemory is capped at 8 by Chrome

const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

// Country code -> browser language (Accept-Language primary tag)
const COUNTRY_LANG = {
  PL: 'pl-PL', US: 'en-US', GB: 'en-GB', IE: 'en-IE', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', DE: 'de-DE', AT: 'de-AT',
  CH: 'de-CH', FR: 'fr-FR', BE: 'fr-BE', NL: 'nl-NL', ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', IT: 'it-IT', PT: 'pt-PT',
  BR: 'pt-BR', CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG', GR: 'el-GR', TR: 'tr-TR', UA: 'uk-UA',
  RU: 'ru-RU', LT: 'lt-LT', LV: 'lv-LV', EE: 'et-EE', FI: 'fi-FI', SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', JP: 'ja-JP',
  KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', IN: 'en-IN', SG: 'en-SG', IL: 'he-IL', AE: 'ar-AE', SA: 'ar-SA',
  HR: 'hr-HR', SI: 'sl-SI', RS: 'sr-RS', VN: 'vi-VN', TH: 'th-TH', ID: 'id-ID', MY: 'ms-MY', PH: 'en-PH', ZA: 'en-ZA',
};

const LANGUAGES = [
  'en-US', 'en-GB', 'pl-PL', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'pt-PT', 'pt-BR', 'cs-CZ', 'sk-SK', 'uk-UA',
  'ru-RU', 'tr-TR', 'ro-RO', 'hu-HU', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'el-GR', 'bg-BG', 'lt-LT', 'lv-LV', 'et-EE',
  'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'ar-SA', 'he-IL', 'hi-IN', 'id-ID', 'vi-VN', 'th-TH',
];

module.exports = { GPUS, SCREENS, CPU, MEMORY, OS_LABEL, COUNTRY_LANG, LANGUAGES };
