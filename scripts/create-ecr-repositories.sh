#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_APP_REPOSITORY="${ECR_APP_REPOSITORY:-project-commander-app}"
ECR_MASTER_REPOSITORY="${ECR_MASTER_REPOSITORY:-project-commander-master}"
LIFECYCLE_POLICY='{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 14 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 14
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}'

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

ensure_repository() {
  local repository_name="$1"
  if aws ecr describe-repositories \
    --repository-names "$repository_name" \
    --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "ECR repository already exists: $repository_name"
  else
    echo "Creating ECR repository: $repository_name"
    aws ecr create-repository \
      --repository-name "$repository_name" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability MUTABLE \
      --region "$AWS_REGION" >/dev/null
  fi

  aws ecr put-lifecycle-policy \
    --repository-name "$repository_name" \
    --lifecycle-policy-text "$LIFECYCLE_POLICY" \
    --region "$AWS_REGION" >/dev/null

  aws ecr describe-repositories \
    --repository-names "$repository_name" \
    --region "$AWS_REGION" \
    --query 'repositories[0].repositoryUri' \
    --output text
}

ensure_repository "$ECR_APP_REPOSITORY"
ensure_repository "$ECR_MASTER_REPOSITORY"
