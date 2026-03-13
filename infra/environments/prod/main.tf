locals {
  project_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])
}

resource "google_project_service" "services" {
  for_each = local.project_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_registry_repository_id
  description   = "Container images for ThinkSpace services"
  format        = "DOCKER"
  labels        = var.labels

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket" "session_artifacts" {
  name                        = var.session_artifacts_bucket_name
  location                    = var.region
  project                     = var.project_id
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false
  labels                      = var.labels

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.services]
}

resource "google_firestore_database" "thinkspace" {
  project     = var.project_id
  name        = var.firestore_database_id
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret" "google_api_key" {
  project   = var.project_id
  secret_id = var.google_api_key_secret_id
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = var.db_password_secret_id
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "_%@"
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = var.runtime_service_account_id
  display_name = "ThinkSpace runtime service account"

  depends_on = [google_project_service.services]
}

resource "google_project_iam_member" "runtime_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_sql_database_instance" "adk" {
  project             = var.project_id
  name                = var.cloud_sql_instance_name
  region              = var.region
  database_version    = "POSTGRES_15"
  deletion_protection = true

  settings {
    tier = var.cloud_sql_tier

    backup_configuration {
      enabled = true
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "adk" {
  project  = var.project_id
  name     = var.cloud_sql_database_name
  instance = google_sql_database_instance.adk.name
}

resource "google_sql_user" "adk" {
  project  = var.project_id
  name     = var.cloud_sql_user_name
  instance = google_sql_database_instance.adk.name
  password = random_password.db_password.result
}
