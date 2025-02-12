import { Refresh } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';
import type { MediaSourceLibrary, MediaSourceSettings } from '@tunarr/types';
import { capitalize } from 'lodash-es';
import type { MRT_ColumnDef } from 'material-react-table';
import {
  MaterialReactTable,
  useMaterialReactTable,
} from 'material-react-table';
import { useCallback, useMemo, useState } from 'react';
import { useRefreshLibraryMutation } from '../hooks/media-sources/mediaSourceLibraryHooks.ts';
import { useMediaSources } from '../hooks/settingsHooks.ts';
import { useDayjs } from '../hooks/useDayjs.ts';

type MediaSourceLibraryRow = MediaSourceLibrary & {
  mediaSource: MediaSourceSettings;
};

type ActionCellProps = {
  library: MediaSourceLibraryRow;
};

const MediaSourceLibraryTableActionCell = ({ library }: ActionCellProps) => {
  const dayjs = useDayjs();
  const [isRefreshing, setIsRefreshing] = useState();
  const refreshLibraryMutation = useRefreshLibraryMutation();

  const startRefresh = useCallback(() => {
    refreshLibraryMutation.mutate({
      libraryId: library.id,
      mediaSourceId: library.mediaSource.id,
    });
  }, [library.id, library.mediaSource.id, refreshLibraryMutation]);

  return (
    <Tooltip
      placement="top"
      title={`Last Scanned: ${library.lastScannedAt ? dayjs(library.lastScannedAt)?.format() : 'never'}`}
    >
      <span>
        <IconButton disabled={library.isLocked} onClick={() => startRefresh()}>
          <Refresh
            sx={{
              animation: library.isLocked
                ? 'spin 2s linear infinite'
                : undefined,
            }}
          />
        </IconButton>
      </span>
    </Tooltip>
  );
};

export const MediaSourceLibraryTable = () => {
  const dayjs = useDayjs();
  const { data: mediaSources } = useMediaSources();

  const refreshLibraryMutation = useRefreshLibraryMutation();

  const columns = useMemo<MRT_ColumnDef<MediaSourceLibraryRow>[]>(() => {
    return [
      {
        header: 'Source Type',
        id: 'type',
        accessorFn: ({ type }) => capitalize(type),
        size: 100,
        enableSorting: false,
      },
      {
        header: 'Source Name',
        id: 'sourceName',
        accessorFn: ({ mediaSource: { name } }) => name,
        size: 150,
        grow: false,
      },
      {
        header: 'Name',
        accessorKey: 'name',
        size: 150,
        grow: false,
      },
      {
        header: 'Media Type',
        accessorKey: 'mediaType',
        size: 150,
        grow: false,
      },
      {
        header: 'Last Synced',
        id: 'lastUpdated',
        accessorFn: ({ lastScannedAt }) =>
          lastScannedAt ? dayjs(lastScannedAt).format() : '-',
      },
    ];
  }, [dayjs]);

  const data = useMemo(
    () =>
      mediaSources
        .flatMap((source) =>
          source.libraries.map((lib) => ({ ...lib, mediaSource: source })),
        )
        .filter((lib) => lib.enabled),
    [mediaSources],
  );

  const table = useMaterialReactTable({
    data,
    columns,
    layoutMode: 'grid',
    enableRowActions: true,
    displayColumnDefOptions: {
      'mrt-row-actions': {
        grow: true,
        Header: '',
        visibleInShowHideMenu: false,
        muiTableBodyCellProps: {
          sx: {
            flexDirection: 'row',
          },
          align: 'right',
        },
      },
    },
    renderRowActions: ({ row: { original: library } }) => (
      <MediaSourceLibraryTableActionCell library={library} />
    ),
    positionActionsColumn: 'last',
  });

  return <MaterialReactTable table={table} />;
};
