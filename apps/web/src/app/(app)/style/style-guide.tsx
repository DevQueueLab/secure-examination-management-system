'use client';

import { EXAM_PHASES } from '@athena/shared';
import { Bell, Inbox, MoreHorizontal, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger, useConfirm } from '@/components/ui/alert-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { GroupedList, GroupedListItem, IconTile } from '@/components/ui/grouped-list';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd, Shortcut } from '@/components/ui/kbd';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar, ProgressRing } from '@/components/ui/progress';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { Section } from '@/components/ui/section';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatTile } from '@/components/ui/stat-tile';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type SortDirection } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';
import { Showcase } from './showcase';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:gap-6">
      <div className="w-36 shrink-0 text-footnote font-medium text-label-secondary">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const PEOPLE = [
  { name: 'Ali Hassan', score: 82 },
  { name: 'Ayesha Malik', score: 91 },
  { name: 'Usman Tariq', score: 67 },
];

/** Every primitive in one place, for review and for feature work to copy from. */
export function StyleGuide() {
  const confirm = useConfirm();
  const [view, setView] = useState<'list' | 'grid' | 'calendar'>('list');
  const [notify, setNotify] = useState(true);
  const [sort, setSort] = useState<SortDirection>('desc');
  const [theme, setTheme] = useState<'default' | 'sepia' | 'contrast'>('default');
  const rows = [...PEOPLE].sort((a, b) => (sort === 'asc' ? a.score - b.score : b.score - a.score));

  return (
    <>
      <PageHeader
        title="Style guide"
        subtitle="The primitives every Athena screen is built from."
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Style guide' }]}
        actions={<SegmentedControl aria-label="Preview theme" size="sm" value={theme} onValueChange={setTheme} options={[{ value: 'default', label: 'App' }, { value: 'sepia', label: 'Sepia' }, { value: 'contrast', label: 'Contrast' }]} />}
      />

      <div data-theme={theme === 'default' ? undefined : theme} className="-mx-4 flex flex-col gap-12 bg-bg px-4 py-2 text-label sm:mx-0 sm:rounded-2xl sm:px-0">
        <Showcase />
        <Section title="Buttons" description="One filled button per view. Press feedback scales on pointer-down.">
          <Card>
            <Row label="Variants">
              <Button variant="filled">Publish</Button>
              <Button variant="tinted">Preview</Button>
              <Button variant="gray">Cancel</Button>
              <Button variant="plain">Learn more</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="destructive-tinted">Remove</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm" variant="filled">Small</Button>
              <Button size="md" variant="filled">Medium</Button>
              <Button size="lg" variant="filled">Large</Button>
            </Row>
            <Row label="States">
              <Button variant="filled" loading>Saving</Button>
              <Button variant="gray" disabled>Disabled</Button>
              <Button variant="tinted">
                <Plus aria-hidden /> With icon
              </Button>
              <Tooltip content="Notifications">
                <Button variant="ghost" size="icon" aria-label="Notifications">
                  <Bell aria-hidden />
                </Button>
              </Tooltip>
            </Row>
          </Card>
        </Section>

        <Section title="Status" description="Tone plus words; colour is never the only signal.">
          <Card>
            <Row label="Tones">
              <Badge>Neutral</Badge>
              <Badge tone="accent">Accent</Badge>
              <Badge tone="success" dot>Passed</Badge>
              <Badge tone="warning" dot>Late</Badge>
              <Badge tone="danger" dot>Failed</Badge>
              <Badge tone="info">Info</Badge>
            </Row>
            <Row label="Exam phases">
              {EXAM_PHASES.map((p) => (
                <PhaseBadge key={p} phase={p} />
              ))}
            </Row>
            <Row label="Progress">
              <div className="w-56">
                <ProgressBar value={64} label="Grading progress" valueText="16 of 25 graded" />
              </div>
              <div className="w-40">
                <ProgressBar label="Uploading" />
              </div>
              <ProgressRing value={72} label="Completion">
                72%
              </ProgressRing>
              <Spinner />
            </Row>
            <Row label="Identity">
              <Avatar name="Dr. Sara Ahmed" size="sm" />
              <Avatar name="Bilal Khan" />
              <Avatar name="Hina Raza" size="lg" />
              <Kbd>Esc</Kbd>
              <Shortcut keys={['mod', 'K']} />
            </Row>
          </Card>
        </Section>

        <Section title="Forms" description="Labels above controls; errors under them, announced and linked.">
          <Card className="grid gap-5 sm:grid-cols-2">
            <Field label="Exam title" hint="Candidates see this on their dashboard." required>
              <Input placeholder="Data Structures, Midterm" />
            </Field>
            <Field label="Duration" error="Enter a duration between 5 and 600 minutes.">
              <Input defaultValue="0" inputMode="numeric" />
            </Field>
            <Field label="Navigation">
              <Select
                defaultValue="free"
                options={[
                  { value: 'free', label: 'Free', description: 'Jump between questions' },
                  { value: 'linear', label: 'Linear', description: 'Forward only' },
                ]}
              />
            </Field>
            <Field label="Instructions">
              <Textarea placeholder="Anything candidates should know before they start" />
            </Field>
            <div className="flex flex-col gap-3">
              <Checkbox label="Shuffle questions" description="Each candidate gets a different order." defaultChecked />
              <Checkbox label="Require fullscreen" />
            </div>
            <RadioGroup defaultValue="partial" aria-label="Multiple select marking">
              <Radio value="all" label="All or nothing" />
              <Radio value="partial" label="Partial credit" description="Each correct pick earns its share." />
            </RadioGroup>
            <div className="flex flex-col gap-3 sm:col-span-2">
              <SegmentedControl
                aria-label="View"
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'list', label: 'List' },
                  { value: 'grid', label: 'Grid' },
                  { value: 'calendar', label: 'Calendar' },
                ]}
              />
            </div>
          </Card>
        </Section>

        <Section title="Grouped list" description="Settings-style rows: links, toggles and values.">
          <GroupedList header="Delivery" footer="Changes apply to exams that haven’t opened yet.">
            <GroupedListItem icon={<IconTile tone="accent"><Users /></IconTile>} title="Candidates" value="128" href="/style" />
            <GroupedListItem
              icon={<IconTile tone="warning"><Bell /></IconTile>}
              title="Notify candidates"
              description="Email when the window opens"
              accessory={<Switch checked={notify} onCheckedChange={setNotify} aria-label="Notify candidates" />}
            />
            <GroupedListItem icon={<IconTile tone="danger"><Trash2 /></IconTile>} title="Archive exam" destructive onClick={() => void confirm({ title: 'Archive this exam?', description: 'Candidates lose access. You can restore it later.', confirmLabel: 'Archive', destructive: true })} />
          </GroupedList>
        </Section>

        <Section title="Overlays">
          <Card>
            <Row label="Modal">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="gray">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader title="Rename exam" description="Candidates see the new name immediately." />
                  <DialogBody>
                    <Field label="Title">
                      <Input defaultValue="Data Structures, Midterm" />
                    </Field>
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="gray">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="filled" onClick={() => toast.success('Exam renamed')}>
                        Save
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="gray">Open sheet</Button>
                </SheetTrigger>
                <SheetContent title="Filters" description="Narrow the list without leaving it.">
                  <div className="flex flex-col gap-4">
                    <Checkbox label="Only live exams" />
                    <Checkbox label="Only exams I own" />
                  </div>
                  <SheetFooter>
                    <Button variant="filled" block>
                      Apply
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive-tinted">Alert dialog</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>Delete 3 questions?</AlertDialogTitle>
                  <AlertDialogDescription>Exams that already use them keep their copies.</AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button variant="gray" size="lg" className="text-callout">Cancel</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button variant="destructive" size="lg" className="text-callout">Delete</Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem icon={<Pencil aria-hidden />} shortcut="⌘E">Edit</DropdownMenuItem>
                  <DropdownMenuItem icon={<Upload aria-hidden />}>Export</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 aria-hidden />} destructive>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Row>
            <Row label="Toasts">
              <Button variant="gray" onClick={() => toast.success('Results published', { description: '128 candidates notified' })}>Success</Button>
              <Button variant="gray" onClick={() => toast.error('Couldn’t publish', { description: 'Two answers still need grading.' })}>Error</Button>
              <Button variant="gray" onClick={() => toast('Draft saved')}>Plain</Button>
            </Row>
          </Card>
        </Section>

        <Section title="Tabs">
          <Card>
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="items">Items</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="summary">
                <SkeletonText lines={2} />
              </TabsContent>
              <TabsContent value="items">
                <Skeleton className="h-16" />
              </TabsContent>
              <TabsContent value="history">
                <SkeletonText lines={3} />
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="all" variant="underline" className="mt-6">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="flagged">Flagged</TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
          </Card>
        </Section>

        <Section title="Data">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Enrolled" value="128" hint="across 3 sections" icon={<Users />} />
            <StatTile label="Submitted" value="96" delta={{ value: '12 today', direction: 'up', tone: 'success' }} />
            <StatTile label="Needs grading" value="14" href="/grading" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead numeric sort={sort} onSort={() => setSort((s) => (s === 'desc' ? 'asc' : 'desc'))}>
                  Score
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name} interactive>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.name} size="sm" />
                      {r.name}
                    </span>
                  </TableCell>
                  <TableCell numeric>{r.score}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={<Inbox />}
            art="owl"
            title="No submissions yet"
            description="Submissions appear here as candidates finish. Nothing to do until then."
            action={<Button variant="tinted">Open monitor</Button>}
          />
        </Section>

        <Section title="Cards">
          <Card>
            <CardHeader title="Exam window" description="Fri 12 Dec, 09:00 to 11:00" action={<Badge tone="info">Scheduled</Badge>} />
            <p className="text-callout text-label-secondary">A card groups one subject. Never nest a card inside another.</p>
          </Card>
        </Section>
      </div>
    </>
  );
}
