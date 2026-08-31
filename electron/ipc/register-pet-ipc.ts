import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { DomainIpcRegistrar } from './secured-ipc-registrar';

export type PetIpcDependencies = {
  registrar: DomainIpcRegistrar;
  get(): unknown;
  list(): Promise<unknown>;
  catalog(): Promise<unknown>;
  asset(petId: unknown): Promise<unknown>;
  importPet(): Promise<unknown>;
  deletePet(petId: unknown): Promise<void>;
  revealPet(petId: unknown): Promise<void>;
  openFolder(): Promise<void>;
  save(raw: unknown): unknown;
  focusMain(target: unknown): void;
  takeOpenTarget(): unknown;
  dragStart(event: IpcMainEvent, screenX: unknown, screenY: unknown): void;
  dragMove(event: IpcMainEvent, screenX: unknown, screenY: unknown): void;
  dragEnd(event: IpcMainEvent): void;
};

export function registerPetIpc(dependencies: PetIpcDependencies): void {
  const { registrar } = dependencies;
  registrar.mainAndPet('pet:get', () => dependencies.get());
  registrar.mainAndPet('pet:list', () => dependencies.list());
  registrar.main('pet:catalog', () => dependencies.catalog());
  registrar.mainAndPet('pet:asset', (_event: IpcMainInvokeEvent, petId: unknown) => dependencies.asset(petId));
  registrar.main('pet:import', () => dependencies.importPet());
  registrar.main('pet:delete', (_event, petId: unknown) => dependencies.deletePet(petId));
  registrar.main('pet:reveal', (_event, petId: unknown) => dependencies.revealPet(petId));
  registrar.main('pet:open-folder', () => dependencies.openFolder());
  registrar.main('pet:save', (_event, raw: unknown) => dependencies.save(raw));
  registrar.pet('pet:focus-main', (_event, target: unknown) => dependencies.focusMain(target));
  registrar.main('pet:open-target:take', () => dependencies.takeOpenTarget());
  registrar.onPet('pet:drag-start', dependencies.dragStart);
  registrar.onPet('pet:drag-move', dependencies.dragMove);
  registrar.onPet('pet:drag-end', dependencies.dragEnd);
}
