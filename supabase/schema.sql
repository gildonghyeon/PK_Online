-- PK Online 닉네임 표
-- Supabase 대시보드 → SQL Editor → New query 에 통째로 붙여 넣고 Run 을 누르세요. (한 번만)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (nickname ~ '^[0-9A-Za-z가-힣_]{2,12}$'),
  updated_at timestamptz not null default now()
);

-- 닉네임은 대소문자 상관없이 한 사람만
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

-- 행 수준 보안: 누구나 닉네임을 볼 수 있고, 자기 줄만 만들고 고칠 수 있음
alter table public.profiles enable row level security;

drop policy if exists "닉네임 보기" on public.profiles;
create policy "닉네임 보기" on public.profiles for select using (true);

drop policy if exists "내 닉네임 만들기" on public.profiles;
create policy "내 닉네임 만들기" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "내 닉네임 바꾸기" on public.profiles;
create policy "내 닉네임 바꾸기" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
