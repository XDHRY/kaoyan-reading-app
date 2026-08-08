import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 项目按"单文件小组件 + 同文件导出常量/Hook"组织(如 ui/*、hooks/*)，
      // react-refresh 仅影响开发期热更新体验，不阻断构建与交付，故关闭。
      'react-refresh/only-export-components': 'off',
      // effect 内同步 setState 是本项目刻意的状态收敛模式(如默认页签回填、首开偏好设置)，
      // 且均有依赖数组约束，非级联渲染热点，关闭该激进检查。
      'react-hooks/set-state-in-effect': 'off',
      // render 期间调用 Date.now()/随机数等是本项目既有写法(如考场计时、题序洗牌)，
      // 不引入外部副作用，关闭。
      'react-hooks/purity': 'off',
      // 下划线前缀变量/参数视为"有意丢弃"(如解构剔除字段 {score: _s})，放行。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
