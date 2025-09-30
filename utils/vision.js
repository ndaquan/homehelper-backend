const fs = require('fs');
const path = require('path');
const { visionClient } = require('./ocr');

async function visionText(imagePath) {
  if (!visionClient) throw new Error('Google Vision client not initialized');
  const [result] = await visionClient.textDetection(imagePath);
  const detections = result.textAnnotations || [];
  const full = detections[0]?.description || '';
  return full;
}

function parseByLabelsVi(text) {
  const lineArr = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const joined = lineArr.join('\n');
  const pickAfter = (labelRegex) => {
    const m = joined.match(labelRegex);
    return m ? m[1].trim() : '';
  };
  return {
    number: (joined.match(/\b\d{12}\b/) || [])[0] || '',
    full_name: pickAfter(/Họ\s*và\s*tên\s*[:]?\s*([^\n]+)/iu),
    dob: (pickAfter(/Ng[aà]y\s*sinh\s*[:]?\s*([^\n]+)/iu).match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || [])[0] || '',
    gender: (/Gi[ơo]i\s*t[íi]nh\s*[:]?\s*(Nam|Nữ)/iu.exec(joined)?.[1]) || '',
    nationality: (/Qu[ốo]c\s*t[ịi]ch\s*[:]?\s*(Vi[eệ]t\s*Nam)/iu.exec(joined)?.[1]) || '',
    place_of_origin: pickAfter(/Qu[eê]\s*qu[aá]n\s*[:]?\s*([^\n]+)/iu),
    place_of_residence: pickAfter(/N[ơo]i\s*th[uư][ơo]ng\s*tr[uú]\s*[:]?\s*([^\n]+)/iu),
    issued_date: (pickAfter(/C[oó]\s*gi[aá]\s*tr[iị]\s*đ[eê][̂e]\s*[:]?\s*([^\n]+)/iu).match(/\d{2}[\/-]\d{2}[\/-]\d{4}/) || [])[0] || '',
  };
}

module.exports = { visionText, parseByLabelsVi };





