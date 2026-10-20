import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

const distRoot = 'dist';
const libName = 'utils';
const bundleName = `clapp-${libName}`;

export default [
  // JavaScript bundle
  {
    input: 'src/public-api.ts',
    output: {
      file: `${distRoot}/${bundleName}.js`,
      format: 'esm',
      sourcemap: true,

    },
    plugins: [
      nodeResolve({
        resolveOnly: []
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: true,
        inlineSources: false,
        exclude: ['node_modules/**']
      }),
    ],
    external: ['jsonc-parser', 'yaml', 'asty-astq', 'pegjs-otf', 'pegjs-util']
  },
  // TypeScript definitions bundle
  {
    input: 'src/public-api.ts',
    output: {
      file: `${distRoot}/${bundleName}.d.ts`,
      format: 'esm'
    },
    plugins: [
      dts()
    ]
  }
];
