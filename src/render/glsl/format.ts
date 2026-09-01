/** GLSL float literal (a bare integer would type as int). */
export const glslFloat = (value: number): string => {
  const text = value.toPrecision(9);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
