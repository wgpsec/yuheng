import type { DatabaseConnection } from '../database';
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

export function createStorageRepositories(db: DatabaseConnection): StorageRepositories {
  return {
    conversations: new ConversationRepository(db),
    notes: new NoteRepository(db),
    providers: new ProviderRepository(db),
    runs: new RunRepository(db),
    search: new SearchRepository(db),
    settings: new SettingsRepository(db),
    tasks: new TaskRepository(db),
    backups: new BackupRepository(db),
  };
}
