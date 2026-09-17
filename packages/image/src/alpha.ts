import { AppError } from '../../contracts/src/errors.js';
import type { AlphaPolicy } from '../../contracts/src/application.js';

export function applyAlphaPolicy(
  source: Uint8Array,
  model: Uint8Array,
  policy: AlphaPolicy
): Uint8Array {
  if (source.byteLength !== model.byteLength) {
    throw new AppError(422, 'OUTPUT_INVALID', '结果与源图像尺寸不一致。');
  }
  if (policy === 'use-model') return model.slice();
  const out = model.slice();
  for (let i = 0; i < out.length; i += 4) {
    const sourceA = source[i + 3]!;
    const modelA = model[i + 3]!;
    if (sourceA > 0 && modelA === 0) {
      throw new AppError(422, 'MISSING_SOURCE_COLOR',
        '模型结果在源可见区域没有可用颜色，不能从透明黑猜测。');
    }
    if (sourceA === 0) {
      out.fill(0, i, i + 4);
    } else {
      out[i] = model[i]!;
      out[i + 1] = model[i + 1]!;
      out[i + 2] = model[i + 2]!;
      out[i + 3] = sourceA;
    }
  }
  return out;
}
