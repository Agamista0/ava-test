-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.account_lockouts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  email text NOT NULL,
  ip_address inet NOT NULL,
  locked_at timestamp with time zone DEFAULT now(),
  locked_until timestamp with time zone NOT NULL,
  reason text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  CONSTRAINT account_lockouts_pkey PRIMARY KEY (id),
  CONSTRAINT account_lockouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.auth_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_info text NOT NULL,
  ip_address inet NOT NULL,
  user_agent text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  last_activity timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  is_active boolean DEFAULT true,
  session_data jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT auth_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.blacklisted_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  jti text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  blacklisted_at timestamp with time zone DEFAULT now(),
  reason text NOT NULL DEFAULT 'logout'::text,
  ip_address inet,
  user_agent text,
  CONSTRAINT blacklisted_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT blacklisted_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  support_id uuid,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'assigned'::text, 'closed'::text])),
  priority text DEFAULT 'normal'::text CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
  subject text,
  jira_ticket_id text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  closed_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT conversations_support_id_fkey FOREIGN KEY (support_id) REFERENCES auth.users(id)
);
CREATE TABLE public.credits_usage_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credits_used integer NOT NULL,
  action_type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT credits_usage_history_pkey PRIMARY KEY (id),
  CONSTRAINT credits_usage_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address inet NOT NULL,
  user_agent text NOT NULL,
  success boolean NOT NULL,
  attempted_at timestamp with time zone DEFAULT now(),
  failure_reason text,
  user_id uuid,
  CONSTRAINT login_attempts_pkey PRIMARY KEY (id),
  CONSTRAINT login_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL CHECK (length(content) >= 1 AND length(content) <= 5000),
  message_type text DEFAULT 'text'::text CHECK (message_type = ANY (ARRAY['text'::text, 'voice'::text, 'file'::text, 'system'::text])),
  file_url text,
  file_name text,
  file_size integer,
  is_ai_response boolean DEFAULT false,
  ai_model text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  voice_url text,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id)
);
CREATE TABLE public.password_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  password_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT password_history_pkey PRIMARY KEY (id),
  CONSTRAINT password_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(name) >= 1 AND length(name) <= 100),
  role text NOT NULL DEFAULT 'user'::text CHECK (role = ANY (ARRAY['user'::text, 'support'::text])),
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_login_at timestamp with time zone,
  is_active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  phone_number text,
  country text,
  city text,
  stripe_customer_id text UNIQUE CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~~ 'cus_%'::text),
  credits integer DEFAULT 0,
  plan_type text DEFAULT 'free'::text,
  subscription_id text,
  subscription_status text DEFAULT 'inactive'::text,
  max_credits integer DEFAULT 80,
  account_status text DEFAULT 'active'::text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.security_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  event_type text NOT NULL,
  ip_address inet NOT NULL,
  user_agent text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'info'::text CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT security_events_pkey PRIMARY KEY (id),
  CONSTRAINT security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.stripe_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processed_at timestamp with time zone DEFAULT now(),
  data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (id)
);
CREATE TABLE public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_product_id text NOT NULL UNIQUE,
  stripe_price_id text NOT NULL UNIQUE,
  plan_name text NOT NULL CHECK (plan_name = ANY (ARRAY['starting'::text, 'scaling'::text, 'summit'::text])),
  display_name text NOT NULL,
  description text,
  price_amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd'::text,
  billing_interval text NOT NULL CHECK (billing_interval = ANY (ARRAY['month'::text, 'year'::text])),
  credits_included integer NOT NULL,
  features jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
);
CREATE TABLE public.support_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text CHECK (category IS NULL OR (category = ANY (ARRAY['marketing'::text, 'scheduling'::text, 'content'::text, 'social'::text, 'administrative'::text, 'other'::text]))),
  priority text DEFAULT 'normal'::text CHECK (priority IS NULL OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
  status text DEFAULT 'open'::text CHECK (status IS NULL OR (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))),
  title text NOT NULL CHECK (length(title) >= 1 AND length(title) <= 200),
  description text NOT NULL,
  jira_ticket_id text,
  assigned_to uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  attachments jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT support_requests_pkey PRIMARY KEY (id),
  CONSTRAINT support_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT support_requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id)
);
CREATE TABLE public.user_2fa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  secret text NOT NULL,
  backup_codes ARRAY,
  is_enabled boolean DEFAULT false,
  enabled_at timestamp with time zone,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_2fa_pkey PRIMARY KEY (id),
  CONSTRAINT user_2fa_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_credits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  current_credits integer NOT NULL DEFAULT 0,
  total_credits_allocated integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  last_reset_date timestamp with time zone DEFAULT now(),
  next_reset_date timestamp with time zone,
  subscription_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_credits_pkey PRIMARY KEY (id),
  CONSTRAINT user_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_credits_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id)
);
CREATE TABLE public.user_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  plan_id uuid NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['active'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text, 'past_due'::text, 'trialing'::text, 'unpaid'::text])),
  current_period_start timestamp with time zone NOT NULL,
  current_period_end timestamp with time zone NOT NULL,
  cancel_at_period_end boolean DEFAULT false,
  canceled_at timestamp with time zone,
  trial_start timestamp with time zone,
  trial_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id)
);