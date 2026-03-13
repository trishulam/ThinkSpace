output "terraform_state_bucket_name" {
  description = "Name of the GCS bucket that stores Terraform state."
  value       = google_storage_bucket.terraform_state.name
}

output "terraform_state_bucket_url" {
  description = "GCS URL for the Terraform state bucket."
  value       = google_storage_bucket.terraform_state.url
}
