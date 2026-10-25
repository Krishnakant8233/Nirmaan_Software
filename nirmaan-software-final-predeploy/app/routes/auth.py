from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    current_user,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy.exc import IntegrityError

from app.extensions import db, limiter
from app.models import User, UserRole, UserStatus, generate_public_id
from app.services.access_control import roles_required

auth_bp = Blueprint("auth", __name__)

_VALID_ROLES = {r.value for r in UserRole}


def _bad_request(message: str, **extra):
    return jsonify(error=message, **extra), 400


@auth_bp.post("/register")
@limiter.limit("5 per hour")
def register():
    """Public self-registration. New accounts start PENDING -- per the
    spec's Boss/Admin authority, someone with the boss role must approve
    them (see approve_user below) before they can log in."""
    data = request.get_json(silent=True)
    if not data:
        return _bad_request("Request body must be JSON.")

    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""
    role = data.get("role") or ""

    if not name or len(name) < 2:
        return _bad_request("Name is required.")
    if not phone or len(phone) < 8:
        return _bad_request("A valid phone number is required.")
    if role not in _VALID_ROLES:
        return _bad_request(f"role must be one of {sorted(_VALID_ROLES)}.")
    if role == UserRole.BOSS.value:
        # Otherwise anyone could self-register as Boss and grant themselves
        # access to every site. Boss accounts are provisioned out of band
        # (seed script / existing Boss creates them directly).
        return _bad_request("Boss accounts can't be created through registration.")

    role_enum = UserRole(role)

    try:
        user = User(
            public_id=generate_public_id(role_enum),
            name=name,
            phone=phone,
            role=role_enum,
            status=UserStatus.PENDING,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
    except ValueError as exc:
        # From User.set_password()'s length check.
        db.session.rollback()
        return _bad_request(str(exc))
    except IntegrityError:
        db.session.rollback()
        return _bad_request("That phone number is already registered.")

    return (
        jsonify(
            message="Registered. A Boss/Admin must approve this account before you can log in.",
            user=user.to_public_dict(),
        ),
        201,
    )


@auth_bp.post("/login")
@limiter.limit("10 per minute; 50 per hour")
def login():
    data = request.get_json(silent=True)
    if not data:
        return _bad_request("Request body must be JSON.")

    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""

    user = User.query.filter_by(phone=phone).first()

    # Identical response for "no such account" and "wrong password" --
    # distinguishing them tells an attacker which phone numbers exist.
    if user is None or not user.check_password(password):
        return jsonify(error="Invalid phone number or password."), 401

    if user.status == UserStatus.PENDING:
        return jsonify(error="Your account is awaiting approval from a Boss/Admin."), 403
    if user.status == UserStatus.SUSPENDED:
        return jsonify(error="This account has been suspended."), 403

    return jsonify(
        access_token=create_access_token(identity=user),
        refresh_token=create_refresh_token(identity=user),
        user=user.to_public_dict(),
    )


@auth_bp.post("/refresh")
@limiter.limit("30 per minute")
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if user is None or user.status != UserStatus.ACTIVE:
        return jsonify(error="Account not found or inactive."), 401
    return jsonify(access_token=create_access_token(identity=user))


@auth_bp.get("/me")
@jwt_required()
def me():
    return jsonify(user=current_user.to_public_dict())


@auth_bp.get("/pending")
@jwt_required()
@roles_required(UserRole.BOSS)
def list_pending():
    pending = User.query.filter_by(status=UserStatus.PENDING).order_by(User.created_at).all()
    return jsonify(users=[u.to_public_dict() for u in pending])


@auth_bp.post("/users/<public_id>/approve")
@jwt_required()
@roles_required(UserRole.BOSS)
def approve_user(public_id):
    user = User.query.filter_by(public_id=public_id).first()
    if user is None:
        return jsonify(error="No such user."), 404
    user.status = UserStatus.ACTIVE
    db.session.commit()
    return jsonify(message=f"{user.name} approved.", user=user.to_public_dict())
