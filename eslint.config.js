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

function startsWithHashbang(text) {
  const firstLine = text.split('\n')[0];
  return firstLine.trimStart().startsWith('#!');
}

const requireLicenseHeader = {
  meta: { type: 'suggestion', fixable: 'code', schema: [] },
  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const text = sourceCode.getText();
        const firstComment = sourceCode
          .getAllComments()
          .find((c) => c.type === 'Block');

        if (
          firstComment &&
          normalizeWhitespace(`/*${firstComment.value}*/`) ===
            expectedNormalized
        ) {
          const textBefore = text.slice(
            0,
            sourceCode.getIndexFromLoc(firstComment.loc.start),
          );
          const afterHashbang = startsWithHashbang(textBefore)
            ? textBefore.slice(textBefore.indexOf('\n') + 1)
            : textBefore;
          if (afterHashbang.trim() === '') {
            return;
          }
        }

        const insertOffset = startsWithHashbang(text)
          ? text.indexOf('\n') + 1
          : 0;

        const misplacedComment = sourceCode
          .getAllComments()
          .find(
            (c) =>
              c.type === 'Block' &&
              normalizeWhitespace(`/*${c.value}*/`) === expectedNormalized,
          );

        context.report({
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          message: 'File must start with the Apache 2.0 license header',
          fix(fixer) {
            const fixes = [
              fixer.insertTextBeforeRange(
                [insertOffset, insertOffset],
                (insertOffset > 0 ? '\n' : '') + LICENSE_HEADER + '\n\n',
              ),
            ];
            if (misplacedComment) {
              const start = sourceCode.getIndexFromLoc(
                misplacedComment.loc.start,
              );
              let end = sourceCode.getIndexFromLoc(misplacedComment.loc.end);
              while (end < text.length && text[end] === '\n') end++;
              fixes.push(fixer.removeRange([start, end]));
            }
            return fixes;
          },
        });
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
