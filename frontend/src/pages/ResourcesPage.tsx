import { useQuery } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { ResourceStack } from '../lib/types'
import { PageHeader } from '../components/PageHeader'
import { ResourceEntryForm } from '../components/ResourceEntryForm'

function formatQuantity(stack: ResourceStack): string {
  if (stack.resource_type.unit === 'pieces') {
    return `${(stack.quantity_pieces ?? 0).toLocaleString()} pcs`
  }
  return `${((stack.quantity_mscu ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} SCU`
}

export function ResourcesPage() {
  const { data: stacks = [], isLoading, isError } = useQuery({
    queryKey: ['resource-stacks'],
    queryFn: async () => unwrapList<ResourceStack>((await api.get('/api/resource-stacks')).data),
  })

  return (
    <Box>
      <PageHeader title="Resources" subtitle="Raw and refined resource stacks across your locations" />
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' },
          alignItems: 'start',
        }}
      >
        <Paper>
          {isLoading && <LinearProgress />}
          {isError && <Alert severity="error">Failed to load resource stacks.</Alert>}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Resource stacks">
              <TableHead>
                <TableRow>
                  <TableCell>Resource</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Quality</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Visibility</TableCell>
                  <TableCell>Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stacks.map((stack) => (
                  <TableRow key={stack.id} hover>
                    <TableCell>{stack.resource_type.name}</TableCell>
                    <TableCell>{stack.resource_type.category}</TableCell>
                    <TableCell align="right">{stack.quality ?? '—'}</TableCell>
                    <TableCell align="right">{formatQuantity(stack)}</TableCell>
                    <TableCell>{stack.location.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={stack.visibility}
                        color={stack.visibility === 'org' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{new Date(stack.updated_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {!isLoading && stacks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No stacks yet — add your first one with the quick-entry form.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
        <ResourceEntryForm />
      </Box>
    </Box>
  )
}
