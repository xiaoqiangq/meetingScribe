import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
test('GFM tables render and raw HTML remains disabled',()=>{
 const html=renderToStaticMarkup(React.createElement(ReactMarkdown,{skipHtml:true,remarkPlugins:[remarkGfm]},'| Role | Action |\n|---|---|\n| Alice | Review |\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))'));
 assert.ok(html.includes('<table>'));assert.ok(html.includes('<td>Alice</td>'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('onerror'));assert.ok(!html.includes('javascript:'));
});
