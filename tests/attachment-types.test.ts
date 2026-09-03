import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentMimeType, knownAttachmentMimeTypes } from '../electron/attachment-types';

test('supports Office document and spreadsheet attachments', () => {
  assert.equal(attachmentMimeType('brief.doc'), 'application/msword');
  assert.equal(attachmentMimeType('brief.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(attachmentMimeType('budget.xls'), 'application/vnd.ms-excel');
  assert.equal(attachmentMimeType('budget.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('known Office MIME mappings remain available', () => {
  assert.deepEqual(
    ['.doc', '.docx', '.xls', '.xlsx'].map((extension) => knownAttachmentMimeTypes[extension]),
    [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  );
});

test('unknown attachment extensions are accepted as opaque binary data', () => {
  assert.equal(attachmentMimeType('archive.zip'), 'application/octet-stream');
  assert.equal(attachmentMimeType('data.custom-format'), 'application/octet-stream');
});
