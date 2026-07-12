const defaultRules = {
	'no-console': process.env.NODE_ENV !== 'development' ? 'error' : 'off',
	'no-debugger': process.env.NODE_ENV !== 'development' ? 'error' : 'off',
	'prettier/prettier': 'error',
	'padding-line-between-statements': [
		'error',
		{
			blankLine: 'always',
			prev: [
				'block',
				'block-like',
				'cjs-export',
				'class',
				'export',
				'import',
				'multiline-block-like',
				'multiline-const',
				'multiline-expression',
				'multiline-let',
				'multiline-var',
			],
			next: '*',
		},
		{
			blankLine: 'always',
			prev: ['const', 'let'],
			next: ['block', 'block-like', 'cjs-export', 'class', 'export', 'import'],
		},
		{
			blankLine: 'always',
			prev: '*',
			next: ['multiline-block-like', 'multiline-const', 'multiline-expression', 'multiline-let', 'multiline-var'],
		},
		{ blankLine: 'any', prev: ['export', 'import'], next: ['export', 'import'] },
	],
	'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
	'no-nested-ternary': 'error',
};

module.exports = {
	root: true,
	env: {
		browser: true,
		node: true,
	},
	plugins: ['@typescript-eslint', 'prettier'],
	extends: ['eslint:recommended', 'prettier'],
	rules: defaultRules,
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
	overrides: [
		{
			files: ['*.ts', '*.vue'],
			parser: 'vue-eslint-parser',
			parserOptions: {
				parser: '@typescript-eslint/parser',
			},
			extends: [
				'plugin:vue/vue3-recommended',
				'eslint:recommended',
				'plugin:@typescript-eslint/recommended',
				'prettier',
			],
			rules: {
				...defaultRules,
				'vue/multi-word-component-names': 'off',
				'vue/require-default-prop': 'off',
				'no-undef': 'off',
				'@typescript-eslint/ban-ts-comment': 'off',
				'@typescript-eslint/no-explicit-any': 'off',
				'@typescript-eslint/no-var-requires': 'off',
				'@typescript-eslint/no-non-null-assertion': 'off',
				'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			},
		},
	],
};
