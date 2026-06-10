export class StructureEmptyError extends Error {
  constructor(message = 'Structure agent produced no screens') {
    super(message);
    this.name = 'StructureEmptyError';
  }
}
