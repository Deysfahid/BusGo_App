package com.busgo.server.mapper;

import com.busgo.server.dto.UserDto;
import com.busgo.server.entity.User;
import org.mapstruct.Mapper;

@Mapper(componentModel = "spring")
public interface UserMapper {
    UserDto toDto(User user);
    User toEntity(UserDto userDto);
}
