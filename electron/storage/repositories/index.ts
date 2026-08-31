import type { DatabaseOwner } from '../database';
import { BackupRepository } from './backup-repository';
import { ConversationRepository } from './conversation-repository';
import { NoteRepository } from './note-repository';
import { ProviderRepository } from './provider-repository';
import { RunRepository } from './run-repository';
import { SearchRepository } from './search-repository';
import { SettingsRepository } from './settings-repository';
import { TaskRepository } from './task-repository';

export type StorageRepositories = {
  conversations: ConversationRepository;
  notes: NoteRepository;
  providers: ProviderRepository;
  runs: RunRepository;
  search: SearchRepository;
  settings: SettingsRepository;
  tasks: TaskRepository;
  backups: BackupRepository;
};

export function createStorageRepositories(owner: DatabaseOwner): StorageRepositories {
  return {
    conversations: new ConversationRepository(owner),
    notes: new NoteRepository(owner),
    providers: new ProviderRepository(owner),
    runs: new RunRepository(owner),
    search: new SearchRepository(owner),
    settings: new SettingsRepository(owner),
    tasks: new TaskRepository(owner),
    backups: new BackupRepository(owner),
  };
}
