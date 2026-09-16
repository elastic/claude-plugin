/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const LICENSE_HEADER = `/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */`;

const normalizeWhitespace = (str) => str.replace(/\s+/g, ' ').trim();
const expectedNormalized = normalizeWhitespace(LICENSE_HEADER);

const requireLicenseHeader = {
  meta: { type: 'suggestion', fixable: 'code', schema: [] },
  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments();
        const hasHeader = comments.some(
          (c) => c.type === 'Block' && normalizeWhitespace(`/*${c.value}*/`) === expectedNormalized,
        );
        if (!hasHeader) {
          context.report({
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            message: 'File must start with the Apache 2.0 license header',
            fix: (fixer) => fixer.insertTextBeforeRange([0, 0], LICENSE_HEADER + '\n\n'),
          });
        }
      },
    };
  },
};

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['skills/**', 'node_modules/**'],
  },
  {
    plugins: {
      'license-header': { rules: { require: requireLicenseHeader } },
    },
    rules: {
      'license-header/require': 'error',
    },
  },
);
